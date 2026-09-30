// checker/stringer_generated.go: the String method that stringer generates for SignatureKind.
use crate::checker::SignatureKind;

const SIGNATURE_KIND_NAME: &[u8] = b"SignatureKindCallSignatureKindConstruct";

const SIGNATURE_KIND_INDEX: [u8; 3] = [0, 17, 39];

impl SignatureKind {
    pub fn string(self) -> Vec<u8> {
        if let Ok(idx) = usize::try_from(self.0) {
            if let (Some(&start), Some(&end)) = (
                SIGNATURE_KIND_INDEX.get(idx),
                SIGNATURE_KIND_INDEX.get(idx + 1),
            ) {
                return SIGNATURE_KIND_NAME
                    .get(usize::from(start)..usize::from(end))
                    .unwrap_or(&[])
                    .to_vec();
            }
        }
        format!("SignatureKind({})", self.0).into_bytes()
    }
}
