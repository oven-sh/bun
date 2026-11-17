//! Frames that are all there, into an output that has room for all of their content.

use crate::block::BlockDecoder;
use crate::destination::Destination;
use crate::dictionary::Dictionary;
use crate::error::{Error, Result};
use crate::format::BlockType;
use crate::frame::{BlockHeader, FrameHeader, Header, can_hold_headers, skippable_len};
use crate::output::Output;
use crate::xxhash::XxHash64;

/// `src` consists of any number of frames. An error takes back what it wrote.
pub fn decompress(
    src: &[u8],
    out: &mut Output<'_>,
    dictionary: Option<&Dictionary<'_>>,
) -> Result<()> {
    let written = out.written();
    decompress_frames(src, out, dictionary).inspect_err(|_| out.rewind(written))
}

fn decompress_frames(
    mut src: &[u8],
    out: &mut Output<'_>,
    dictionary: Option<&Dictionary<'_>>,
) -> Result<()> {
    let mut blocks = BlockDecoder::default();
    let mut is_first = true;
    while !src.is_empty() {
        src = match &Header::read(src) {
            &Ok(Header::Skippable { content_len }) => {
                (src.get(skippable_len(content_len)?..)).ok_or(Error::SrcSizeWrong)?
            }
            Ok(Header::Incomplete(_)) => return Err(Error::SrcSizeWrong),
            _ if !can_hold_headers(src) => return Err(Error::SrcSizeWrong),
            Ok(Header::Frame(header)) => {
                is_first = false;
                decompress_frame(&mut blocks, header, src, false, out, dictionary)?
            }
            Err(Error::PrefixUnknown) if !is_first => return Err(Error::SrcSizeWrong),
            &Err(error) => return Err(error),
        };
    }
    Ok(())
}

/// `frame` starts with `header`. `is_last` is whether it seems to be the last frame. Returns what follows the frame.
pub(crate) fn decompress_frame<'s>(
    blocks: &mut BlockDecoder,
    header: &FrameHeader,
    frame: &'s [u8],
    is_last: bool,
    out: &mut Output<'_>,
    dictionary: Option<&Dictionary<'_>>,
) -> Result<&'s [u8]> {
    header.check_dictionary(dictionary)?;
    blocks.start_frame(dictionary);
    let mut src = frame.get(header.len..).ok_or(Error::Internal)?;
    let mut hash = header.has_checksum.then(XxHash64::new);
    let history_start = out.written();
    loop {
        let (block, rest) = src.split_first_chunk().ok_or(Error::SrcSizeWrong)?;
        let block = BlockHeader::new(*block)?;
        let (content, rest) =
            (rest.split_at_checked(block.content_len())).ok_or(Error::SrcSizeWrong)?;
        src = rest;
        if block.block_type() == BlockType::Compressed && content.len() > header.block_len_max() {
            return Err(Error::SrcSizeWrong);
        }
        let history_len = out.written() - history_start;
        let external = dictionary.map(Dictionary::history).unwrap_or_default();
        let room = out.room();
        let mut destination = Destination::new(out, header, history_len, external, room);
        destination.is_last_frame = is_last;
        let so_far = frame
            .get(..frame.len() - rest.len())
            .ok_or(Error::Internal)?;
        let len = blocks.decode(block, so_far, content.len(), dictionary, destination)?;
        if let Some(hash) = &mut hash {
            hash.update(out.last_written(len));
        }
        header.check_content_size((out.written() - history_start) as u64, block.is_last())?;
        if block.is_last() {
            break;
        }
    }
    if let Some(hash) = hash {
        let (checksum, rest) = src.split_first_chunk().ok_or(Error::ChecksumWrong)?;
        if u32::from_le_bytes(*checksum) != hash.digest() as u32 {
            return Err(Error::ChecksumWrong);
        }
        src = rest;
    }
    Ok(src)
}
