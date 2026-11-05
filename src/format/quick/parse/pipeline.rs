use crate::ast::{F_PAREN, k};
use crate::parse::core::NO_IN_FSHARP_BODY;
use crate::{Quick, R, Words};

pub(crate) struct ParsePipeline {
    pub(crate) pipeline_proposal: i32,
    /// The text has a `|>`: another proposal is worth a try if this one fails.
    pub(crate) saw_pipeline: bool,
    /// The tree has a topic reference (`__isUsingHackPipeline`).
    pub(crate) uses_hack_pipeline: bool,
    pub(crate) topic_used: bool,
    pub(crate) topic_depth: i32,
}
impl ParsePipeline {
    pub(crate) fn new() -> Self {
        Self {
            pipeline_proposal: 0,
            saw_pipeline: false,
            uses_hack_pipeline: false,
            topic_used: false,
            topic_depth: 0,
        }
    }
}

pub(crate) const PIPELINE_HACK: i32 = 0;
pub(crate) const PIPELINE_MINIMAL: i32 = 1;
pub(crate) const PIPELINE_FSHARP: i32 = 2;
impl Quick {
    pub(crate) fn set_pipeline_proposal(&mut self, proposal: i32) {
        self.parse_pipeline.pipeline_proposal = proposal;
        self.parse_pipeline.saw_pipeline = false;
        self.parse_pipeline.uses_hack_pipeline = false;
        self.parse_pipeline.topic_used = false;
        self.parse_pipeline.topic_depth = 0;
    }

    pub(crate) fn is_in_hack_pipe_body(&self) -> bool {
        return self.parse_pipeline.topic_depth != 0;
    }

    /// The parser has met a `%` where an operand stands.
    pub(crate) fn note_topic_reference(&mut self, at: i32) -> R<()> {
        if self.parse_pipeline.pipeline_proposal != PIPELINE_HACK
            || self.parse_pipeline.topic_depth == 0
        {
            return Err(self.fail(at));
        }
        self.parse_pipeline.topic_used = true;
        self.parse_pipeline.uses_hack_pipeline = true;
        Ok(())
    }

    /// What follows a `|>`, which has been consumed. `prec` is its precedence.
    pub(crate) fn parse_pipeline_body(&mut self, prec: i32) -> R<i32> {
        self.parse_pipeline.saw_pipeline = true;
        let start = self.lexer.tok_start;
        if self.parse_pipeline.pipeline_proposal == PIPELINE_HACK {
            let outer_used = self.parse_pipeline.topic_used;
            self.parse_pipeline.topic_used = false;
            self.parse_pipeline.topic_depth += 1;
            let body = self.parse_expression()?;
            self.parse_pipeline.topic_depth -= 1;
            if (self.n.at(body) & F_PAREN) == 0 {
                let k = self.n.at(body) & 0xff;
                if k == k::ArrowFunctionExpression
                    || k == k::AssignmentExpression
                    || k == k::ConditionalExpression
                    || k == k::YieldExpression
                {
                    return Err(self.fail(start));
                }
            }
            if !self.parse_pipeline.topic_used {
                return Err(self.fail(start));
            }
            self.parse_pipeline.topic_used = outer_used;
            return Ok(body);
        }
        if self.parse_pipeline.pipeline_proposal == PIPELINE_FSHARP {
            let saved = self.parse.no_in;
            self.set_no_in(saved | NO_IN_FSHARP_BODY);
            let v0 = self.parse_maybe_unary()?;
            let body = self.parse_expr_op(v0, start, prec)?;
            self.set_no_in(saved);
            return Ok(body);
        }
        let v1 = self.parse_maybe_unary()?;
        let body = self.parse_expr_op(v1, start, prec)?;
        if self.is_bare_arrow(body) {
            return Err(self.fail(start));
        }
        return Ok(body);
    }
}
