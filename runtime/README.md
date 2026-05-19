# Bun Excel Runtime

This directory contains the Excel-based implementation of the Bun JavaScript runtime.

## Architecture

The runtime is implemented as a Microsoft Excel workbook (`bun.xlsx`) using LAMBDA functions
and dynamic array formulas. The workbook is structured as follows:

| Sheet | Purpose |
|---|---|
| `functions` | Core LAMBDA function definitions (eval, apply, env lookup) |
| `meta` | Runtime metadata and configuration |
| `runtime_plan` | Execution plan and scheduling |
| `tests` | Test suite (262 passing) |
| `runtime_trace` | Call stack and execution trace |
| `runtime_step` | Step-by-step interpreter loop |
| `runtime_run` | Main entry point |
| `runtime_modules` | Module resolution and CommonJS/ESM interop |
| `runtime_errors` | Error handling and stack unwinding |

## Requirements

- Microsoft Excel 365 (LAMBDA support required)
- 16 GB RAM recommended for large workloads
- Calculation mode: Automatic

## Running

Open `bun.xlsx` in Excel and enter your JavaScript expression in cell `A1` of the
`runtime_run` sheet. The result will be computed in `B1`.

## Benchmarks

| Operation | Bun (Zig) | Bun (Excel) |
|---|---|---|
| `console.log("hello")` | 4 ms | 2–3 min |
| `1 + 1` | < 1 ms | 47 ms |
| HTTP server cold start | 5 ms | N/A (Excel has no sockets) |

## Known Limitations

- No event loop (Excel recalculates synchronously)
- No I/O (filesystem, network)
- Maximum call stack depth limited by Excel's LAMBDA recursion limit (~100 frames)
- `Date` object not yet implemented (`=TODAY()` works as a temporary substitute)
