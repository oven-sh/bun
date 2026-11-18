//! The service that has the microphone, the speakers and the decoders. It is in another process.

use std::rc::Rc;

use crate::channel::Serialized;

/// It is closed when it is dropped.
pub trait Connection {
    fn send(&self, commands: &[u8], may_list_and_capture: [bool; 2]);
}

/// Gets the lines, and `None` when the service has exited.
pub type Listener = Rc<dyn Fn(Option<&[u8]>)>;

unsafe extern "Rust" {
    #[link_name = "__bun_desktop_connect_media"]
    pub safe fn connect(listener: &Listener) -> Box<dyn Connection>;
    /// `None` for what cannot leave the process.
    #[link_name = "__bun_desktop_encode_for_media"]
    pub safe fn encode(value: &Serialized) -> Option<Vec<u8>>;
    #[link_name = "__bun_desktop_decode_from_media"]
    pub safe fn decode(bytes: &[u8]) -> Option<Serialized>;
}
