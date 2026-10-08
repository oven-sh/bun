//! esquery selectors, which some options of ESLint's rules are written in (`no-restricted-syntax`, `ignoredNodes` of `indent`).
//!
//! A selector is compiled once, when the configuration is loaded, into a matcher on the handles of [`crate::ast`]. No ESTree is
//! built: the names of ESTree's types and fields in the selector are bound to the accessors in the table of `crate::estree`.
