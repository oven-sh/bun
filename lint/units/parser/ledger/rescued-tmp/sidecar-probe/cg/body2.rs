{
        let p = self;
        let mut items: Vec<u64> = Vec::new();
        let mut errors = [0u32; 2];
        let mut colon_at = 0usize;
        p.scopes.push(loc as u32);
        let scope_index = p.scopes.len() - 1;
        let old_allow_in = p.allow_in;
        p.allow_in = true;
        while p.lexer.token != b')' {
            let is_spread = p.lexer.token == b'.';
            if is_spread { p.lexer.next()?; }
            p.latest = p.lexer.start;
            LINT_ITEM_START!(p, item_start);
            let mut item = p.parse_expr(2)?;
            if is_spread { item ^= 0x5555; }
            if p.lexer.token == b':' {
                colon_at = p.lexer.start + 1;
                p.lexer.next()?;
                ANNOTATION!(p, item_start, items);
            }
            if p.lexer.token == b'=' { p.lexer.next()?; let rhs = p.parse_expr(2)?; item = item.wrapping_mul(rhs | 1); }
            items.push(item);
            if p.lexer.token != b',' { break; }
            p.lexer.next()?;
        }
        if p.lexer.token != b')' { return Err(3); }
        p.lexer.next()?;
        p.allow_in = old_allow_in;
        let mut is_arrow = p.lexer.token == b'=';
        if is_arrow || p.lexer.token == b':' {
            if level > 4 { return Err(4); }
            let mut args: Vec<u64> = Vec::new();
            for i in 0..items.len() { args.push(items[i].rotate_left(3)); }
            if p.lexer.token == b':' {
                RETURN_TYPE!(p, loc, is_arrow);
            }
            if is_arrow {
                p.log_errors(&mut errors);
                let v = p.arrow_body(&args)?;
                p.scopes.pop();
                return Ok(v);
            }
        }
        p.pop_and_flatten(scope_index);
        if colon_at > 0 { p.log.push(colon_at as u32); return Err(5); }
        if !items.is_empty() { p.log_errors(&mut errors); return Ok(items.iter().fold(0u64, |a, b| a.wrapping_add(*b))); }
        Err(6)
}
