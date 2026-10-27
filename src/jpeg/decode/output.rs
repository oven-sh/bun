//! The whole of decoding after the header: choosing the parts (jdmaster.c), running the scans (jdapistd.c, jdinput.c),
//! and taking the samples through upsampling and color conversion row by row (jdmainct.c, jdsample.c).

use super::arith::ArithDecoder;
use super::coef::{CoefController, Entropy, Idct, Plane};
use super::color::{self, Conversion};
use super::huff::HuffDecoder;
use super::lossless::DiffController;
use super::marker::Reached;
use super::phuff::PHuffDecoder;
use super::upsample::{self, Method};
use super::{ColorSpace, DCTSIZE, Decoder, PixelFormat, div_round_up, round_up};
use crate::error::{Error, Result, try_vec};

enum Source {
    Lossy(CoefController),
    Lossless(Box<DiffController>),
}

/// What turns the rows of one component into rows of the image.
struct Upsampler {
    method: Method,
    /// Rows of the component that go into `max_v_samp` rows of the image.
    rowgroup_height: usize,
    /// Rows of the component in an iMCU row.
    rows: usize,
    /// The same for the last iMCU row, without the rows below the bottom of the image.
    last_rows: usize,
    /// Samples in a row, without the ones past the right edge of the image.
    width: usize,
    /// The last row of the iMCU row above the current one.
    above: Vec<u8>,
    /// `max_v_samp` upsampled rows. Unused if the component has full size.
    buffer: Plane,
}

impl Decoder<'_> {
    /// The size of the image that `decode` makes at `scale` eighths.
    pub fn scaled_size(&self, scale: u32) -> (u32, u32) {
        (
            div_round_up(self.width * scale, DCTSIZE),
            div_round_up(self.height * scale, DCTSIZE),
        )
    }

    /// Decodes the image at `scale` eighths of its size, from 1 to 8, into 4 bytes per pixel. This can be done once.
    pub fn decode(&mut self, scale: u32, format: PixelFormat) -> Result<Vec<u8>> {
        if !(1..=DCTSIZE).contains(&scale)
            || (scale != DCTSIZE && !self.scalable())
            || self.input_scan_number != 1
        {
            return Err(Error::InvalidArgument);
        }
        let (output_width, output_height) = self.scaled_size(scale);
        let min_dct_scaled_size = if self.lossless { 1 } else { scale };
        if !self.lossless {
            self.scale_components(scale);
        }
        if self.precision > 8 {
            return Err(Error::BadPrecision(self.precision));
        }

        let conversion = self.select_conversion(format)?;
        let mut upsamplers = self.select_upsamplers(min_dct_scaled_size, output_width)?;
        let mut source = if self.lossless {
            if self.arith_code {
                return Err(Error::ArithNotImpl);
            }
            Source::Lossless(Box::new(DiffController::new(self)?))
        } else {
            let entropy = if self.arith_code {
                Entropy::Arith(Box::new(ArithDecoder::new(self)))
            } else if self.progressive {
                Entropy::PHuff(Box::new(PHuffDecoder::new(self)))
            } else {
                Entropy::Huff(Box::new(HuffDecoder::new(self)))
            };
            Source::Lossy(CoefController::new(self, entropy)?)
        };

        let new_planes = |d: &Self| -> Result<Vec<Plane>> {
            let plane = |comp: &super::Component| {
                let size = comp.dct_scaled_size as usize;
                Plane::new(
                    comp.width_in_blocks as usize * size,
                    comp.v_samp as usize * size,
                )
            };
            d.comps.iter().map(plane).collect()
        };
        let mut current = new_planes(self)?;
        let need_context = upsamplers.iter().any(|up| up.method.needs_context());
        let mut next = if need_context {
            new_planes(self)?
        } else {
            Vec::new()
        };

        let row_bytes = output_width as usize * 4;
        let mut pixels = try_vec(0, row_bytes * output_height as usize)?;

        self.start_input_pass(&mut source)?;
        if self.has_multiple_scans {
            // All of the input comes before any of the output.
            loop {
                match &mut source {
                    Source::Lossy(coef) => coef.consume_scan(self)?,
                    Source::Lossless(diff) => diff.consume_scan(self)?,
                }
                match self.read_markers()? {
                    Reached::Sos => self.start_input_pass(&mut source)?,
                    Reached::Eoi => break,
                }
            }
            self.eoi_reached = true;
        }

        let idcts: Vec<Idct> = self
            .comps
            .iter()
            .map(|comp| Idct::new(comp.dct_scaled_size, comp.quant_table.as_ref()))
            .collect();
        if let Source::Lossy(coef) = &mut source {
            coef.start_output_pass(self);
        }

        let mut emitter = Emitter {
            conversion,
            max_v_samp: self.max_v_samp as usize,
            rowgroups: min_dct_scaled_size as usize,
            output_width: output_width as usize,
            rows: pixels.chunks_exact_mut(row_bytes.max(1)),
            column_sums: Vec::new(),
        };
        let total = self.total_imcu_rows;
        for imcu_row in 0..total {
            // With context, an iMCU row is emitted once the one below it is there.
            let planes = if need_context && imcu_row > 0 {
                &mut next
            } else {
                &mut current
            };
            match (&mut source, self.has_multiple_scans) {
                (Source::Lossy(coef), false) => coef.decompress_onepass(self, &idcts, planes)?,
                (Source::Lossy(coef), true) => {
                    coef.decompress_data(self, imcu_row, &idcts, planes)?
                }
                (Source::Lossless(diff), false) => diff.decompress_onepass(self, planes)?,
                (Source::Lossless(diff), true) => diff.output_data(self, imcu_row, planes)?,
            }
            if !need_context {
                emitter.emit(
                    &mut upsamplers,
                    &current,
                    None,
                    imcu_row == 0,
                    imcu_row + 1 == total,
                );
            } else if imcu_row > 0 {
                emitter.emit(&mut upsamplers, &current, Some(&next), imcu_row == 1, false);
                for (up, plane) in upsamplers.iter_mut().zip(&current) {
                    if up.method.needs_context() {
                        up.above.clear();
                        up.above.extend_from_slice(plane.row(up.rows - 1));
                    }
                }
                core::mem::swap(&mut current, &mut next);
            }
        }
        if need_context {
            emitter.emit(&mut upsamplers, &current, None, total == 1, true);
        }

        // Whatever follows has to be well formed up to the end of the image.
        if !self.eoi_reached {
            match self.read_markers()? {
                Reached::Sos => return Err(Error::EoiExpected),
                Reached::Eoi => self.eoi_reached = true,
            }
        }
        Ok(pixels)
    }

    /// A subsampled component is brought closer to full size by a larger inverse DCT where that works out, which saves
    /// upsampling.
    fn scale_components(&mut self, min_dct_scaled_size: u32) {
        for comp in &mut self.comps {
            let mut ssize = min_dct_scaled_size;
            while ssize < DCTSIZE
                && (self.max_h_samp * min_dct_scaled_size).is_multiple_of(comp.h_samp * ssize * 2)
                && (self.max_v_samp * min_dct_scaled_size).is_multiple_of(comp.v_samp * ssize * 2)
            {
                ssize *= 2;
            }
            comp.dct_scaled_size = ssize;
            comp.downsampled_width =
                div_round_up(self.width * comp.h_samp * ssize, self.max_h_samp * DCTSIZE);
            comp.downsampled_height =
                div_round_up(self.height * comp.v_samp * ssize, self.max_v_samp * DCTSIZE);
        }
    }

    fn select_conversion(&self, format: PixelFormat) -> Result<Conversion> {
        let conversion = match (format, self.color_space()) {
            (PixelFormat::Rgba, ColorSpace::Rgb) => Conversion::RgbToRgba,
            (PixelFormat::Cmyk, ColorSpace::Cmyk) => Conversion::Cmyk,
            // A lossless stream only converts in ways that lose nothing, and libjpeg counts none of these among them.
            _ if self.lossless => return Err(Error::ConversionNotImpl),
            (PixelFormat::Rgba, ColorSpace::Grayscale) => Conversion::GrayToRgba,
            (PixelFormat::Rgba, ColorSpace::YCbCr) => Conversion::YccToRgba,
            (PixelFormat::Cmyk, ColorSpace::Ycck) => Conversion::YcckToCmyk,
            _ => return Err(Error::ConversionNotImpl),
        };
        Ok(conversion)
    }

    fn select_upsamplers(
        &self,
        min_dct_scaled_size: u32,
        output_width: u32,
    ) -> Result<Vec<Upsampler>> {
        // At 1/8 there is no room for the rows of context that interpolation needs.
        let fancy = min_dct_scaled_size > 1;
        let (h_out, v_out) = (self.max_h_samp, self.max_v_samp);
        let mut upsamplers = Vec::new();
        for comp in &self.comps {
            let h_in = comp.h_samp * comp.dct_scaled_size / min_dct_scaled_size;
            let v_in = comp.v_samp * comp.dct_scaled_size / min_dct_scaled_size;
            let replicate = Method::Replicate {
                h_expand: h_out / h_in,
                v_expand: v_out / v_in,
            };
            let method = if h_in == h_out && v_in == v_out {
                Method::FullSize
            } else if h_in * 2 == h_out && v_in == v_out {
                if fancy && comp.downsampled_width > 2 {
                    Method::H2V1Fancy
                } else {
                    replicate
                }
            } else if h_in == h_out && v_in * 2 == v_out && fancy {
                Method::H1V2Fancy
            } else if h_in * 2 == h_out && v_in * 2 == v_out {
                if fancy && comp.downsampled_width > 2 {
                    Method::H2V2Fancy
                } else {
                    replicate
                }
            } else if h_out % h_in == 0 && v_out % v_in == 0 {
                replicate
            } else {
                return Err(Error::FractSampleNotImpl);
            };

            let rows = comp.v_samp * comp.dct_scaled_size;
            upsamplers.push(Upsampler {
                method,
                rowgroup_height: v_in as usize,
                rows: rows as usize,
                last_rows: match comp.downsampled_height % rows {
                    0 => rows,
                    n => n,
                } as usize,
                width: comp.downsampled_width as usize,
                above: Vec::new(),
                buffer: if method == Method::FullSize {
                    Plane::default()
                } else {
                    Plane::new(round_up(output_width, h_out) as usize, v_out as usize)?
                },
            });
        }
        Ok(upsamplers)
    }

    fn start_input_pass(&mut self, source: &mut Source) -> Result<()> {
        self.per_scan_setup()?;
        match source {
            Source::Lossy(coef) => {
                self.latch_quant_tables()?;
                coef.entropy.start_pass(self)?;
                coef.start_input_pass(self)
            }
            Source::Lossless(diff) => diff.start_input_pass(self),
        }
    }
}

struct Emitter<'p> {
    conversion: Conversion,
    max_v_samp: usize,
    /// Row groups in an iMCU row. Each makes `max_v_samp` rows of the image.
    rowgroups: usize,
    output_width: usize,
    /// The rows of the image that are still to be written.
    rows: core::slice::ChunksExactMut<'p, u8>,
    column_sums: Vec<u16>,
}

impl Emitter<'_> {
    /// Writes the rows of the image that the iMCU row in `current` makes. `below` is the iMCU row after it, if the
    /// upsampling looks at it. Above the top and below the bottom of the image the outermost row repeats.
    fn emit(
        &mut self,
        upsamplers: &mut [Upsampler],
        current: &[Plane],
        below: Option<&[Plane]>,
        top: bool,
        bottom: bool,
    ) {
        for rowgroup in 0..self.rowgroups {
            if self.rows.len() == 0 {
                return;
            }
            for (ci, (up, plane)) in upsamplers.iter_mut().zip(current).enumerate() {
                let Upsampler { above, buffer, .. } = up;
                let (width, rows) = (up.width, up.rows);
                let limit = if bottom { up.last_rows } else { rows };
                // `y` is one more than the row within the iMCU row, so that 0 is the row above it.
                let row = |y: usize| -> &[u8] {
                    let row = match y.checked_sub(1) {
                        None if top => plane.row(0),
                        None => above.as_slice(),
                        Some(y) if y < limit => plane.row(y),
                        Some(_) if bottom => plane.row(limit - 1),
                        Some(y) => below
                            .and_then(|below| below.get(ci))
                            .map_or(&[][..], |plane| plane.row(y - rows)),
                    };
                    row.get(..width).unwrap_or(&[])
                };
                let first = rowgroup * up.rowgroup_height + 1;
                let stride = buffer.stride.max(1);
                let mut out_rows = buffer.data.chunks_exact_mut(stride);

                match up.method {
                    Method::FullSize => {}
                    Method::H2V1Fancy => {
                        for (y, out) in (first..).zip(out_rows) {
                            upsample::h2v1_fancy(row(y), out);
                        }
                    }
                    Method::H1V2Fancy => {
                        for y in first..first + up.rowgroup_height {
                            if let (Some(upper), Some(lower)) = (out_rows.next(), out_rows.next()) {
                                upsample::h1v2_fancy(row(y), row(y - 1), true, upper);
                                upsample::h1v2_fancy(row(y), row(y + 1), false, lower);
                            }
                        }
                    }
                    Method::H2V2Fancy => {
                        for y in first..first + up.rowgroup_height {
                            if let (Some(upper), Some(lower)) = (out_rows.next(), out_rows.next()) {
                                upsample::h2v2_fancy(
                                    row(y),
                                    row(y - 1),
                                    &mut self.column_sums,
                                    upper,
                                );
                                upsample::h2v2_fancy(
                                    row(y),
                                    row(y + 1),
                                    &mut self.column_sums,
                                    lower,
                                );
                            }
                        }
                    }
                    Method::Replicate { h_expand, v_expand } => {
                        for y in first..first + up.rowgroup_height {
                            let Some(out) = out_rows.next() else { break };
                            let out = out.get_mut(..self.output_width).unwrap_or(&mut []);
                            upsample::replicate(row(y), h_expand, out);
                            for _ in 1..v_expand {
                                if let Some(copy) = out_rows.next() {
                                    for (copy, &v) in copy.iter_mut().zip(out.iter()) {
                                        *copy = v;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            for r in 0..self.max_v_samp {
                let Some(output) = self.rows.next() else {
                    return;
                };
                let mut planes: [&[u8]; 4] = [&[]; 4];
                for ((input, up), plane) in planes.iter_mut().zip(upsamplers.iter()).zip(current) {
                    *input = if up.method == Method::FullSize {
                        plane.row(rowgroup * up.rowgroup_height + r)
                    } else {
                        up.buffer.row(r)
                    };
                }
                color::convert(self.conversion, planes, output);
            }
        }
    }
}
