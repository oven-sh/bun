//! C ABI and C++ headers for Bun's bindings.

// References to cells are plain pointers, and what C++ cannot look into it only passes on.
#![allow(improper_ctypes, improper_ctypes_definitions)]

mod abi;
mod api;
mod layout;
mod support;
mod text;
