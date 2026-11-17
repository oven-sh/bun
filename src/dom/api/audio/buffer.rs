//! https://webaudio.github.io/web-audio-api/#AudioBuffer

use std::rc::Rc;

use bun_jsc::JSType;
use bun_jsc::bindgen::{BufferSource, try_zeroed_bytes};

use super::*;

pub(crate) struct AudioBuffer {
    remote: Remote,
    sample_rate: f32,
    length: u32,
}

pub(super) fn check_rate(rate: f32) -> core::result::Result<f32, Failure> {
    if (3000.0..=768_000.0).contains(&rate) {
        Ok(rate)
    } else {
        Err(not_supported("The sample rate is out of range."))
    }
}

pub(super) fn check_shape(
    channels: u32,
    length: u32,
    rate: f32,
) -> core::result::Result<(), Failure> {
    if !(1..=MAX_CHANNELS).contains(&channels) || length == 0 {
        return Err(not_supported(
            "The number of channels or the length is out of range.",
        ));
    }
    check_rate(rate).map(drop)
}

impl Mirrored for AudioBuffer {
    fn remote(&self) -> &Remote {
        &self.remote
    }

    #[optimize(size)]
    fn create<'a>(&'a self, heap: &JsHeap<'a>) {
        self.remote.send(
            "buffer",
            &[
                Arg::Number(self.sample_rate.into()),
                self.channels().len().into(),
                self.length.into(),
            ],
        );
        for (at, channel) in (0u32..).zip(self.channels().values()) {
            buffer_source(heap, channel).with_bytes(heap, |it| {
                self.remote
                    .invoke("copyToChannel", &[Arg::Floats(it), at.into()])
            });
        }
    }
}

fn buffer_source<'a>(heap: &JsHeap<'a>, array: JSValue) -> JsLocal<'a, BufferSource> {
    // SAFETY: a typed array, which a list holds.
    unsafe { JsLocal::from_extern(array, heap) }
}

impl AudioBuffer {
    fn fill<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        count: u32,
        mut write: impl FnMut(usize, &mut [u8]),
    ) -> Result<'a, &'a AudioBuffer> {
        let channels = List::with_capacity(heap, count);
        for at in 0..count as usize {
            let mut bytes = try_zeroed_bytes(self.length as usize * 4).ok_or_else(|| {
                heap.range_error(format_args!("There is no memory for the buffer."))
            })?;
            write(at, &mut bytes);
            channels.push(
                heap,
                heap.create_typed_array_from_box(JSType::Float32Array, bytes)?
                    .to_js(),
            );
        }
        js_AudioBuffer::set_channels(self, channels.to_js());
        Ok(self)
    }

    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        options: &AudioBufferOptions,
    ) -> Result<'a, &'a Self> {
        let AudioBufferOptions {
            length,
            number_of_channels,
            sample_rate,
        } = *options;
        check_shape(number_of_channels, length, sample_rate)
            .map_err(|it| it.into_error(&cx.heap))?;
        let remote = Remote::new(current_link(cx)?);
        structure
            .create(
                &cx.heap,
                AudioBuffer {
                    remote,
                    sample_rate,
                    length,
                },
            )
            .fill(&cx.heap, number_of_channels, |_, _| {})
    }

    #[optimize(size)]
    pub(super) fn silent<'a>(
        heap: &JsHeap<'a>,
        link: &Rc<Link>,
        channels: u32,
        length: u32,
        sample_rate: f32,
    ) -> Result<'a, &'a Self> {
        check_shape(channels, length, sample_rate).map_err(|it| it.into_error(heap))?;
        js_AudioBuffer::create(
            heap,
            AudioBuffer {
                remote: Remote::new(Rc::clone(link)),
                sample_rate,
                length,
            },
        )
        .fill(heap, channels, |_, _| {})
    }

    /// Each part from `first` on is a channel.
    #[optimize(size)]
    pub(super) fn from_message<'a>(
        heap: &JsHeap<'a>,
        link: &Rc<Link>,
        sample_rate: f32,
        message: &Message<'_>,
        first: usize,
    ) -> Result<'a, &'a Self> {
        let channels: Vec<_> = (first..message.parts.len())
            .map(|at| message.bytes(at))
            .collect();
        let length = channels.first().map_or(0, |it| it.len() / 4) as u32;
        check_shape(channels.len() as u32, length, sample_rate)
            .map_err(|it| it.into_error(heap))?;
        let buffer = js_AudioBuffer::create(
            heap,
            AudioBuffer {
                remote: Remote::new(Rc::clone(link)),
                sample_rate,
                length,
            },
        );
        buffer.fill(heap, channels.len() as u32, |at, bytes| {
            bytes
                .iter_mut()
                .zip(&channels[at])
                .for_each(|(to, from)| *to = *from)
        })
    }

    /// Unless it is silent.
    #[optimize(size)]
    pub(super) fn play_through(&self, heap: &JsHeap<'_>, processor: &Remote) {
        let channels: Vec<_> = self
            .channels()
            .values()
            .map(|it| buffer_source(heap, it).with_bytes(heap, <[u8]>::to_vec))
            .collect();
        if channels.iter().flatten().any(|it| *it != 0) {
            processor.send(
                "output",
                &[Arg::List(
                    &channels
                        .iter()
                        .map(|it| Arg::Floats(it))
                        .collect::<Vec<_>>(),
                )],
            );
        }
    }

    fn channels(&self) -> List<'_> {
        List::from_value(js_AudioBuffer::channels(self).unwrap_or_default())
    }

    /// What plays goes on with what it had.
    fn channel(&self, index: u32) -> core::result::Result<JSValue, Failure> {
        if index >= self.channels().len() {
            return Err(Failure::index_size("There is no such channel."));
        }
        self.remote.outdate();
        Ok(self.channels().get(index))
    }

    pub(crate) fn get_sample_rate(&self) -> f32 {
        self.sample_rate
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.length
    }

    pub(crate) fn get_duration(&self) -> f64 {
        f64::from(self.length) / f64::from(self.sample_rate)
    }

    pub(crate) fn get_number_of_channels(&self) -> u32 {
        self.channels().len()
    }

    pub(crate) fn get_channel_data(
        &self,
        _: &JsHeap<'_>,
        channel: u32,
    ) -> core::result::Result<JSValue, Failure> {
        self.channel(channel)
    }

    pub(crate) fn copy_from_channel<'a>(
        &self,
        heap: &JsHeap<'a>,
        destination: Floats<'a>,
        channel: u32,
        offset: u32,
    ) -> core::result::Result<(), Failure> {
        destination.as_buffer_source().copy_from(
            heap,
            0,
            buffer_source(heap, self.channel(channel)?),
            offset as usize * 4,
        );
        Ok(())
    }

    pub(crate) fn copy_to_channel<'a>(
        &self,
        heap: &JsHeap<'a>,
        source: Floats<'a>,
        channel: u32,
        offset: u32,
    ) -> core::result::Result<(), Failure> {
        buffer_source(heap, self.channel(channel)?).copy_from(
            heap,
            offset as usize * 4,
            source.as_buffer_source(),
            0,
        );
        Ok(())
    }
}

pub(crate) struct PeriodicWave {
    remote: Remote,
    real: Vec<f32>,
    imaginary: Vec<f32>,
    disables_normalization: bool,
}

impl Mirrored for PeriodicWave {
    fn remote(&self) -> &Remote {
        &self.remote
    }

    #[optimize(size)]
    fn create<'a>(&'a self, heap: &JsHeap<'a>) {
        let options = [
            ("real", Arg::floats(&self.real)),
            ("imag", Arg::floats(&self.imaginary)),
            (
                "disableNormalization",
                Arg::Flag(self.disables_normalization),
            ),
        ];
        if let Some(context) = js_PeriodicWave::context(self) {
            self.remote.send(
                "node",
                &[
                    context.copy(heap).object(),
                    "PeriodicWave".into(),
                    Arg::Record(&options),
                ],
            );
        }
    }
}

impl PeriodicWave {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        context: &'a BaseAudioContext,
        options: &PeriodicWaveOptions,
    ) -> core::result::Result<&'a Self, Failure> {
        let (real, imaginary) = match (&options.real, &options.imag) {
            (Some(real), Some(imaginary)) => (real.clone(), imaginary.clone()),
            (Some(real), None) => (real.clone(), vec![0.0; real.len()]),
            (None, Some(imaginary)) => (vec![0.0; imaginary.len()], imaginary.clone()),
            (None, None) => (vec![0.0; 2], vec![0.0, 1.0]),
        };
        if real.len() != imaginary.len() || real.len() < 2 {
            return Err(Failure::index_size(
                "The arrays need the same length, which is at least 2.",
            ));
        }
        let remote = Remote::new(Rc::clone(&context.remote().link));
        let wave = structure.create(
            heap,
            PeriodicWave {
                remote,
                real,
                imaginary,
                disables_normalization: options.disable_normalization,
            },
        );
        js_PeriodicWave::set_context(wave, Some(context));
        Ok(wave)
    }
}
