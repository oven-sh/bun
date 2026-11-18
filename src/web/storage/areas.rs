//! `localStorage` and `sessionStorage` of a page process are copies of those in the host.

use std::sync::Arc;

use bun_ui::protocol::Lane;

use super::{AreaChange, Storage};
use crate::Bytes;
use crate::net::record::{RecordReader, RecordWriter};
use crate::remote::{self, Flags, Head, Kind, Peer};
use crate::wire;

crate::wire! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Whose {
        Session(u32),
        Tab(u32),
    }

    #[derive(Default)]
    pub struct Items {
        records: Vec<u8>,
        /// Of the last change.
        pub version: u64,
    }

    pub struct Changed {
        pub whose: Whose,
        pub bucket: Bytes,
        /// `None` if it is only about `applied`.
        pub change: Option<AreaChange>,
        pub old_value: Option<Bytes>,
        /// `None` if scripts are not told.
        pub url: Option<Bytes>,
        pub version: u64,
        /// The number of the last change that the receiver has made and the host knows of.
        pub applied: u64,
    }
}

impl wire::Message for Changed {
    fn most_bytes(_: u16) -> usize {
        wire::LARGE
    }
}

impl Items {
    pub fn new(version: u64, all: impl Iterator<Item = [Bytes; 2]>) -> Items {
        let mut records = RecordWriter::default();
        all.flatten().for_each(|it| records.bytes(&it));
        let records = records.0;
        Items { records, version }
    }

    pub fn each(&self, mut item: impl FnMut(&[u8], &[u8])) {
        let mut rest = RecordReader(&self.records);
        while let (Some(key), Some(value)) = (rest.bytes(), rest.bytes()) {
            item(key, value);
        }
    }
}

impl Changed {
    pub fn send(self, to: Peer) {
        let head = Head::new(Kind::Area, 0, 0).with(Flags::HARMLESS);
        remote::send(to, Lane::Scripts, head, self);
    }
}

/// For a document in a page process.
pub struct Borrower {
    pub peer: Peer,
    pub whose: Whose,
    pub storage: Arc<Storage>,
    pub bucket: Vec<u8>,
}

unsafe extern "Rust" {
    #[link_name = "__bun_dom_watch_area"]
    pub(crate) safe fn watch(by: &Borrower);
    #[link_name = "__bun_dom_lend_area"]
    pub(crate) safe fn lend(to: &Borrower) -> Items;
    #[link_name = "__bun_dom_change_area"]
    pub(crate) safe fn change(by: &Borrower, change: &AreaChange, number: u64, url: &[u8]);
    #[link_name = "__bun_dom_forget_watcher_of_areas"]
    pub(crate) safe fn forget(peer: Peer);
    #[link_name = "__bun_dom_area_changed"]
    pub safe fn changed(it: &Changed);
}
