# Bun.otel against the OpenTelemetry JavaScript SDK

Both sides run the same code through `@opentelemetry/api` and export OTLP/protobuf to the same collector.

```sh
bun install
bun run.ts <bun under test> [bun of main]
bun run.ts <bun under test> [bun of main] --aot   # each program built with `bun compile`
```
