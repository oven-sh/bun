pub struct BStr([u8]);
impl BStr {
    pub fn new(bytes: &[u8]) -> &BStr {
        // SAFETY: BStr is a transparent stand-in over [u8] for this scratch check only.
        unsafe { &*(bytes as *const [u8] as *const BStr) }
    }
}
impl core::fmt::Display for BStr {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        for &b in &self.0 {
            write!(f, "{}", b as char)?;
        }
        Ok(())
    }
}
