
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_number_is_written_as_javascript_writes_it() {
        let written: [(f64, &str); 16] = [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.5, "-1.5"),
            (100.0, "100"),
            (0.1, "0.1"),
            (123456789012345680000.0, "123456789012345680000"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (5e-324, "5e-324"),
            (f64::MAX, "1.7976931348623157e+308"),
            (f64::NAN, "NaN"),
            (f64::NEG_INFINITY, "-Infinity"),
        ];
        for (number, text) in written {
            let mut buf = [0u8; 124];
            let len = WTF__dtoa(&mut buf, number);
            assert_eq!(
                bun_core::BStr::new(&buf[..len]),
                bun_core::BStr::new(text.as_bytes()),
                "{number:e}"
            );
        }
    }
}
