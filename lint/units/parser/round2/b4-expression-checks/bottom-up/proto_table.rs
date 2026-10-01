    /// The last record is the one of a unary expression before `**`, made for the last message of `log`, and that expression starts right after the operator that ends at `operator_end`: the unary expression at `start` takes the record, as `to`.
    #[allow(clippy::too_many_arguments)]
    fn widen_unary_before_exponent(
        &mut self,
        log: &Log,
        source: &[u8],
        comments: &[Range],
        start: u32,
        operator_end: u32,
        to: Message,
        argument: &[u8],
    ) {
        let Some(last) = self.recorded.last_mut() else {
            return;
        };
        if !last.is_live(log) || last.error.msg as usize + 1 != log.msgs.len() {
            return;
        }
        if last.error.code != 17006 && last.error.code != 17007 {
            return;
        }
        if ts::full_start(source, comments, last.error.start) != operator_end {
            return;
        }
        last.error.start = start;
        last.error.code = to.code;
        last.error.text = to.format(argument);
    }
