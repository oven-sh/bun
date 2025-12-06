//! Sandbox module for agent sandboxes.
//!
//! This module provides tools for creating and managing ephemeral agent environments
//! based on Sandboxfile declarations.

pub const sandboxfile = @import("sandbox/sandboxfile.zig");
pub const Sandboxfile = sandboxfile.Sandboxfile;
pub const Parser = sandboxfile.Parser;
pub const validate = sandboxfile.validate;
