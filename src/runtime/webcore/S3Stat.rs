use bun_core::String as BunString;
use bun_jsc::{JSGlobalObject, JsResult, bun_string_jsc};

pub(crate) struct S3Stat {
    pub(crate) size: u64,
    pub(crate) etag: BunString,
    pub(crate) content_type: BunString,
    pub(crate) last_modified: f64,
}

impl S3Stat {
    pub(crate) fn init(
        size: u64,
        etag: &[u8],
        content_type: &[u8],
        last_modified: &[u8],
        global: &JSGlobalObject,
    ) -> JsResult<Self> {
        let last_modified =
            bun_string_jsc::parse_date(&BunString::from_bytes(last_modified), global)?;

        Ok(S3Stat {
            size,
            etag: BunString::clone_utf8(etag),
            content_type: BunString::clone_utf8(content_type),
            last_modified,
        })
    }
}

impl S3Stat {
    pub(crate) fn get_etag(&self) -> BunString {
        self.etag.clone()
    }

    pub(crate) fn get_last_modified(&self) -> f64 {
        self.last_modified
    }

    pub(crate) fn get_size(&self) -> u64 {
        self.size
    }

    pub(crate) fn get_content_type(&self) -> BunString {
        self.content_type.clone()
    }
}
