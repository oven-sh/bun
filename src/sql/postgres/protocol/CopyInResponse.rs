use super::new_reader::NewReader;

pub struct CopyInResponse;

impl CopyInResponse {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        &mut self,
        reader: NewReader<Container>,
    ) -> Result<(), crate::Error> {
        drop(reader);
        let _ = self;
        bun_core::output::panic(format_args!("TODO: not implemented {}", "CopyInResponse"));
    }

    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        context: Container,
    ) -> Result<(), crate::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}
