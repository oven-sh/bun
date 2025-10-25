# ADR-004: Instrumentation Package Architecture

**Status**: Accepted
**Date**: 2025-10-23
**Feature**: OpenTelemetry Support for Bun

## Context

The Bun runtime provides both native HTTP server capabilities (`Bun.serve()`) and Node.js compatibility layer (`http.createServer()`). Both need telemetry integration for OpenTelemetry support. The question is where to locate the TypeScript code that maps native telemetry hooks to OpenTelemetry spans.

Three architectural approaches were considered:

1. Internal runtime module (`src/js/internal/telemetry_http.ts`)
2. Inline code within `_http_server.ts`
3. User-loadable instrumentation package (`packages/bun-otel/`)

This decision has significant implications for startup performance, code maintainability, and ability to import OpenTelemetry packages.

## Decisions

### 1. Instrumentation Code Lives in User-Loadable Packages

**Decision**: TypeScript instrumentation code for OpenTelemetry integration MUST be located in user-loadable packages (`packages/bun-otel/`), NOT in internal runtime modules (`src/js/internal/`).

**Rationale**:

- Internal modules load on every startup when their API is used (e.g., when `http` module is imported)
- This adds parsing overhead (~0.5-1ms) and memory footprint (~5-15KB) even when telemetry is disabled
- Violates zero-cost abstraction principle (CON-001, CON-002) - applications not using telemetry pay startup cost
- Internal modules cannot import npm packages, requiring duplication of OpenTelemetry semantic convention constants
- User-loadable packages only load when explicitly imported by application code

**Flow**:

```
Application Code
  → import { BunHttpInstrumentation } from 'bun-otel'  // Only loads if imported
    → BunHttpInstrumentation.enable()
      → Bun.telemetry.attach({ type: InstrumentKind.HTTP, ... })
        → Native hooks registered
```

**Consequences**:

- Zero startup cost for applications not using telemetry (achieves SC-004 <0.1% overhead)
- Instrumentation can import `@opentelemetry/api` and `@opentelemetry/semantic-conventions` packages
- Code only parsed when needed (lazy evaluation)
- Clear separation between runtime (Bun core) and observability (packages)
- Users explicitly opt-in by importing the package

### 2. Internal Modules Call Native Hooks Directly

**Decision**: Internal runtime modules (e.g., `src/js/node/_http_server.ts`) MUST call native `Bun.telemetry` hooks directly without requiring intermediate TypeScript bridge modules.

**Rationale**:

- Minimal insertion surface area keeps `_http_server.ts` changes small and maintainable
- Native hooks are lightweight checks (inline functions, ~5ns overhead when disabled)
- No TypeScript bridge module means zero TypeScript loading overhead
- Direct native calls avoid roundtrip overhead on every request
- Separation of concerns: insertion points (internal) vs. instrumentation logic (packages)

**Integration Points** (4 locations in `_http_server.ts`):

```typescript
// Request arrival
Bun.telemetry.internalHooks.notifyHttpRequestStart(req, res);
```

**Consequences**:

- Only 2 insertions point needed in `_http_server.ts` and `_http_client.ts`
- All complexity (span creation, context propagation, attribute mapping) handled in package
- Native functions can be no-ops when telemetry disabled (compiler optimization)
- Easy to audit insertion points (simple function calls)
- No risk of internal module loading overhead

### 3. Package Can Import OpenTelemetry Packages

**Decision**: Instrumentation packages MAY import OpenTelemetry npm packages (e.g., `@opentelemetry/api`, `@opentelemetry/semantic-conventions`) to access official constants and types.

**Rationale**:

- Semantic convention constants must match official OpenTelemetry specifications
- Type definitions ensure API compatibility with OpenTelemetry ecosystem
- Utilities (AsyncLocalStorage, propagators) should not be reimplemented
- No risk of version skew between constants and specs
- Official packages are peer dependencies (user controls versions)

**Example**:

```typescript
// packages/bun-otel/src/instruments/BunHttpInstrumentation.ts
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import {
  SEMATTRS_HTTP_METHOD,
  SEMATTRS_HTTP_STATUS_CODE,
} from "@opentelemetry/semantic-conventions";

export class BunHttpInstrumentation {
  private onOperationStart(id: number, attributes: Record<string, any>) {
    const span = this.tracer.startSpan("http.server.request", {
      kind: SpanKind.SERVER,
      attributes: {
        [SEMATTRS_HTTP_METHOD]: attributes["http.request.method"],
        [SEMATTRS_HTTP_STATUS_CODE]: attributes["http.response.status_code"],
      },
    });
  }
}
```

**Consequences**:

- Official semantic convention constants used throughout
- Type safety enforced via OpenTelemetry TypeScript types
- Future OpenTelemetry updates automatically available (via package upgrades)
- Internal modules remain lightweight (no npm dependencies)
- Clear documentation reference (point to OpenTelemetry specs)

### 4. POC Internal Module Approach Rejected

**Decision**: The POC implementation's internal module approach (`src/js/internal/telemetry_http.ts`) is explicitly rejected for the final implementation.

**Rationale**:

- POC proved the concept but revealed performance limitations
- Internal module loads on every `http` import (even without telemetry)
- Cannot import `@opentelemetry/*` packages (required constant duplication)
- Violates zero-cost principle (CON-001, CON-002)
- Package architecture achieves same functionality with better performance

**POC vs Final**:
| Aspect | POC (Internal Module) | Final (Package) |
|--------|----------------------|-----------------|
| Load time | On `http` import | On explicit import |
| Startup cost | ~0.5-1ms always | 0ms when not used |
| Memory cost | ~5-15KB always | 0 KB when not used |
| Can import OTel | ❌ No | ✅ Yes |
| SC-004 compliance | ❌ Violates | ✅ Achieves |
| Constant duplication | ✅ Required | ❌ Not needed |

**Consequences**:

- POC testing strategy document preserved but updated for new architecture
- POC test examples remain valuable (same insertion points, different architecture)
- Migration path from POC to final documented in implementation plan
- Lessons learned from POC inform package design

## Alternatives Considered

### Alternative 1: Internal Module (`src/js/internal/telemetry_http.ts`)

**Approach**: Create internal TypeScript module that bridges native hooks to OpenTelemetry.

**Advantages**:

- All telemetry code in one location
- Easier to navigate codebase (everything in `src/`)

**Disadvantages**:

- Loads on every startup (violates CON-001, CON-002)
- Cannot import npm packages (constant duplication required)
- Performance cost even when telemetry disabled (fails SC-004)
- Increases Bun runtime bundle size
- Mixes runtime concerns with observability concerns

**Rejected**: Violates zero-cost principle and architectural separation.

### Alternative 2: Inline in `_http_server.ts`

**Approach**: Embed span creation logic directly in `_http_server.ts`.

**Advantages**:

- No additional modules needed
- All code in one file

**Disadvantages**:

- Massive code duplication (would need to duplicate for `server.zig` too)
- Cannot import `@opentelemetry/*` packages
- Makes `_http_server.ts` harder to maintain
- Violates single responsibility principle
- No way to share code between Bun.serve and Node.js http

**Rejected**: Creates maintenance nightmare and prevents code reuse.

### Alternative 3: Separate Packages for Native and Node.js

**Approach**: Create `bun-otel-native` and `bun-otel-node` packages.

**Advantages**:

- Clear separation of concerns
- Users can install only what they need

**Disadvantages**:

- Code duplication for shared logic (context propagation, header mapping)
- Two test suites to maintain
- Inconsistent behavior between implementations
- User confusion about which package to use
- Most users need both (applications often mix Bun.serve and Node.js modules)

**Rejected**: Increases maintenance burden without significant benefit.

## References

- POC Implementation: `/Users/jacob.dilles/github/worktree/bun-fork-old/src/js/internal/telemetry_http.ts`
- POC Testing Strategy: `/Users/jacob.dilles/github/worktree/bun-fork-old/packages/bun-otel/TEST_STRATEGY.md`
- Implementation Plan: `specs/001-opentelemetry-support/implementation-plan-nodejs-http-telemetry.md`
- Constraints: `specs/001-opentelemetry-support/constraints.md` (CON-024 through CON-030)
- OpenTelemetry JavaScript Instrumentation: `@opentelemetry/instrumentation` package patterns
- Node.js OTel HTTP Instrumentation: `@opentelemetry/instrumentation-http` reference implementation
