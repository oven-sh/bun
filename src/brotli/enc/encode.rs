//! The streaming encoder.

use super::params::EncoderMode;

pub struct Encoder;

pub fn max_compressed_size(_input_size: usize) -> usize {
    0
}

pub fn compress(_quality: i32, _lgwin: i32, _mode: EncoderMode, _input: &[u8], _output: &mut [u8]) -> Option<usize> {
    None
}

pub fn compress_append(_quality: i32, _lgwin: i32, _mode: EncoderMode, _input: &[u8], _output: &mut Vec<u8>) -> bool {
    false
}
