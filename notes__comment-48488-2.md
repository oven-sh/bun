#48716 now targets main and has the commits of this PR: its branch was stacked on this one, and main is merged into it.

It replaces the member path that this PR adds (`ModuleTypes::members`, `member_type`, `Written::noted_member`, `text_of_types_that_name_nothing`) with one table for every unannotated member, and keeps the rest: `text_that_names_nothing` for constants, the order at the end of a minified class, one copy of a decorator, and no `override` behind `declare`. The tests of this PR are in #48716 and pass there.

So only #48716 needs a review. This PR is obsolete when #48716 merges.
