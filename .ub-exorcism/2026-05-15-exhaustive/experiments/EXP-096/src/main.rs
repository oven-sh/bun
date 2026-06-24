use std::mem::ManuallyDrop;

const TAG: usize = 0x8000_0000_0000_0000;
const NEGATED_TAG: usize = !TAG;

#[repr(transparent)]
struct SmolStr(u128);

impl SmolStr {
    fn raw_len(&self) -> u32 {
        (self.0 & 0xffff_ffff) as u32
    }

    fn set_raw_len(&mut self, v: u32) {
        self.0 = (self.0 & !0xffff_ffffu128) | (v as u128);
    }

    fn set_raw_cap(&mut self, v: u32) {
        self.0 = (self.0 & !(0xffff_ffffu128 << 32)) | ((v as u128) << 32);
    }

    fn raw_ptr_bits(&self) -> usize {
        (self.0 >> 64) as usize
    }

    fn set_raw_ptr_bits(&mut self, v: usize) {
        self.0 = (self.0 & 0xffff_ffff_ffff_ffffu128) | ((v as u128) << 64);
    }

    fn ptr_const(&self) -> *const u8 {
        (self.raw_ptr_bits() & NEGATED_TAG) as *const u8
    }

    fn mark_heap(&mut self) {
        self.set_raw_ptr_bits(self.raw_ptr_bits() & NEGATED_TAG);
    }

    fn from_baby_list(values: Vec<u8>) -> Self {
        let mut values = ManuallyDrop::new(values);
        let mut out = SmolStr(0);
        out.set_raw_len(values.len() as u32);
        out.set_raw_cap(values.capacity() as u32);
        // Mirrors src/bun_core/string/SmolStr.rs:120-124.
        out.set_raw_ptr_bits(values.as_mut_ptr() as usize);
        out.mark_heap();
        out
    }

    fn slice(&self) -> &[u8] {
        // Mirrors src/bun_core/string/SmolStr.rs:162-163 via ptr_const().
        unsafe { std::slice::from_raw_parts(self.ptr_const(), self.raw_len() as usize) }
    }
}

fn main() {
    let s = SmolStr::from_baby_list(vec![1, 2, 3, 4]);
    let _ = s.slice()[0];
}

