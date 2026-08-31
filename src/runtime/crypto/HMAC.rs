use bun_boringssl_sys as boringssl;

use super::evp;

pub struct HMAC {
    ctx: boringssl::HmacCtx,
    pub(crate) algorithm: evp::Algorithm,
}

impl HMAC {
    pub(crate) fn init(algorithm: evp::Algorithm, key: &[u8]) -> Option<Box<HMAC>> {
        let md = algorithm.md()?;
        let ctx = boringssl::HmacCtx::new(key, md)?;
        Some(Box::new(HMAC { ctx, algorithm }))
    }

    pub(crate) fn update(&mut self, data: &[u8]) {
        let _ = self.ctx.update(data);
    }

    pub(crate) fn size(&self) -> usize {
        self.ctx.size()
    }

    pub(crate) fn copy(&mut self) -> crate::Result<Box<HMAC>> {
        let ctx = self.ctx.copy().ok_or(crate::Error::BoringSSLError)?;
        Ok(Box::new(HMAC {
            ctx,
            algorithm: self.algorithm,
        }))
    }

    pub(crate) fn r#final<'a>(&mut self, out: &'a mut [u8]) -> &'a mut [u8] {
        let outlen = self.ctx.final_(out);
        &mut out[..outlen]
    }
}
