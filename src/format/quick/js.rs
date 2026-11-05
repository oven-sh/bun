use crate::lang::lang;
use crate::parse::core::{TYPED_FLOW, TYPED_TS};
use crate::parse::pipeline::{PIPELINE_FSHARP, PIPELINE_HACK, PIPELINE_MINIMAL};
use crate::{Quick, R, Stop, Words, why};

impl Quick {
    /// isFlowFile() of parse/babel.js: the name ends in .js.flow, or @flow or @noflow stands in the comments before the first token.
    pub(crate) fn is_flow_file(&self) -> bool {
        if self.options.name_ends_in_js_flow {
            return true;
        }
        let mut p = self.text.src_start;
        if self.t.at(p) == 35 && self.t.at(p + 1) == 33 {
            while p < self.text.src_end && self.t.at(p) != 10 && self.t.at(p) != 13 {
                p += 1;
            }
        }
        loop {
            let c = self.t.at(p);
            if c == 32 || c == 9 || c == 10 || c == 13 {
                p += 1;
                continue;
            }
            if c != 47 || (self.t.at(p + 1) != 47 && self.t.at(p + 1) != 42) {
                return false;
            }
            let is_block = self.t.at(p + 1) == 42;
            p += 2;
            'l2: while p < self.text.src_end {
                'c3: {
                    let d = self.t.at(p);
                    if if is_block {
                        d == 42 && self.t.at(p + 1) == 47
                    } else {
                        d == 10 || d == 13
                    } {
                        break 'l2;
                    }
                    if d != 64 {
                        break 'c3;
                    }
                    let q = if self.t.at(p + 1) == 110 && self.t.at(p + 2) == 111 {
                        p + 3
                    } else {
                        p + 1
                    };
                    if self.t.at(q) != 102
                        || self.t.at(q + 1) != 108
                        || self.t.at(q + 2) != 111
                        || self.t.at(q + 3) != 119
                    {
                        break 'c3;
                    }
                    let after = self.t.at(q + 4);
                    if !((after >= 48 && after <= 57)
                        || (after >= 65 && after <= 90)
                        || (after >= 97 && after <= 122)
                        || after == 95)
                    {
                        return true;
                    }
                }
                p += 1;
            }
            if p >= self.text.src_end {
                return false;
            }
            if is_block {
                p += 2;
            }
        }
    }
}

impl Quick {
    /// What has to happen before a new file is looked at.
    pub(crate) fn begin_root(&mut self, language: i32) {
        self.set_verified(0, 0);
        self.set_comment_window(0, 0);
        self.reset_comments();
        self.reset_key_cache();
        self.reset_embed();
        self.lang.lang = language;
    }

    /// TypeScript: whether `<a>` is an element or a type assertion depends on the name of the file. Without one, both are tried.
    fn parse_type_script(&mut self) -> R<i32> {
        if self.name_says_jsx >= 0 {
            self.set_parser_mode(TYPED_TS, self.name_says_jsx != 0);
            return self.parse_program();
        }
        let jsx = self.is_probably_jsx(self.text.src_start, self.text.src_end);
        let comments = self.lexer.c_count;
        self.set_parser_mode(TYPED_TS, jsx);
        match self.parse_program() {
            Err(Stop) if self.why == why::SYNTAX => {
                self.set_comment_window(self.lexer.c_base, comments);
                self.set_parser_mode(TYPED_TS, !jsx);
                self.parse_program()
            }
            result => result,
        }
    }

    /// Tries the proposals for `|>` in turn.
    fn parse(&mut self) -> R<i32> {
        self.set_pipeline_proposal(PIPELINE_HACK);
        let comments = self.lexer.c_count;
        match self.parse_once() {
            Err(Stop) if self.why == why::SYNTAX && self.parse_pipeline.saw_pipeline => {}
            result => return result,
        }
        let mut proposal = PIPELINE_MINIMAL;
        while proposal <= PIPELINE_FSHARP {
            self.set_comment_window(self.lexer.c_base, comments);
            self.set_pipeline_proposal(proposal);
            match self.parse_once() {
                Err(Stop) if self.why == why::SYNTAX => {}
                result => return result,
            }
            proposal += 1;
        }
        Err(Stop)
    }

    /// The language of this run: files of Flow are read as Babel reads Flow.
    fn mode_of_run(&self) -> i32 {
        if self.lang.lang == lang::Babel && self.is_flow_file() {
            lang::BabelFlow
        } else {
            self.lang.lang
        }
    }

    fn parse_once(&mut self) -> R<i32> {
        self.set_parser_mode(0, true);
        self.set_is_common_js(self.name_is_common_js);
        self.set_flow_comments(self.mode.js_mode_language == lang::BabelFlow);
        self.set_type_script_spaces(self.lang.lang == lang::TypeScript);
        self.set_lenient_jsx_text(self.lang.lang == lang::Flow);
        if self.mode.js_mode_language == lang::BabelFlow || self.lang.lang == lang::Flow {
            self.set_parser_mode(TYPED_FLOW, true);
            return self.parse_program();
        }
        if self.lang.lang == lang::TypeScript {
            return self.parse_type_script();
        }
        self.parse_program()
    }

    pub(crate) fn format_js(&mut self) -> R<()> {
        let mode = self.mode_of_run();
        self.set_js_mode(mode);
        let root = self.parse()?;
        self.stage(0);
        self.attach_comments(root)?;
        if self.comments.trailing_count == 0 {
            self.set_suffix_possible(false);
        }
        self.stage(1);
        self.print(root)
    }
}
