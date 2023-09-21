#pragma once

// Get the amount of memory that can be allocated, accounting for Linux containers.
uint64_t uv_get_constrained_memory();