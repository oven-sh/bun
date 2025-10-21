# ADR-003: Type Definition Location and API Surface Design

**Status**: Accepted
**Date**: 2025-10-21
**Feature**: OpenTelemetry Support for Bun

## Context

The Bun telemetry API requires TypeScript type definitions that serve two distinct audiences:
1. **End users** who want to write custom instrumentations or understand the Bun runtime API
2. **bun-otel SDK internals** that need type-safe access to internal APIs and numeric enums

The question is: where should these types live, and how should they be structured to serve both audiences without leaking internal implementation details?

## Decision

### Type Definitions Split Across Two Packages

**Public API** (`packages/bun-types/telemetry.d.ts`):
- Contains user-facing types available when importing from `"bun"`
- Uses string literals for ergonomic API: `type: "http"` instead of `type: InstrumentKind.HTTP`
- Exposes only public namespace methods: `attach()`, `detach()`, `listInstruments()`, `getActiveSpan()`
- **Excludes** `nativeHooks` namespace (internal implementation detail)
- **Excludes** numeric enums like `ConfigurationProperty` (internal Zig mapping)

**Internal API** (`packages/bun-otel/types.ts`):
- Contains SDK-internal types, NOT exported from package
- Uses numeric enums for type-safe Zig FFI: `enum InstrumentKind { Custom = 0, HTTP = 1, ... }`
- Extends `Bun.telemetry` namespace via module augmentation to add `nativeHooks`
- Provides helper functions to map string literals to enum values
- Only imported by bun-otel internal implementation files

### String Literals vs Numeric Enums

**Public API uses string literals**:
```typescript
const id = Bun.telemetry.attach({
  type: "http",  // ← Ergonomic, self-documenting
  name: "my-instrumentation",
  // ...
});
```

**Internal API uses numeric enums**:
```typescript
import { InstrumentKind } from "./types"; // bun-otel internal

// Type-safe mapping to Zig values
switch (kind) {
  case InstrumentKind.HTTP: // ← Compile-time checked, maps to 1
    // ...
}
```

## Rationale

### 1. Native Code Should Be Shared

**Constraint**: Anyone might want to create bespoke instrumentation without using bun-otel.

If types were only in bun-otel:
- Users would need to install bun-otel even if they want a custom implementation
- Circular dependency: user code → bun-otel → bun runtime
- Forces specific SDK architecture choices on all users

By placing native API types in bun-types:
- Available to all Bun users automatically (zero dependencies)
- Users can build custom telemetry solutions (e.g., direct APM vendor integration)
- No forced dependency on OpenTelemetry SDK
- Clear separation: runtime API vs SDK implementation

### 2. Ergonomic Public API

String literals provide better DX:
- Self-documenting: `type: "http"` vs `type: 1` or `type: InstrumentKind.HTTP`
- No import needed: strings are primitive values
- More stable: string values won't change, enum export names might
- Familiar: matches common JavaScript patterns (event types, etc.)

### 3. Type-Safe Internal API

Numeric enums provide better implementation safety:
- Compile-time validation of Zig enum mapping
- Exhaustiveness checking in switch statements
- Clear documentation of all possible values
- Prevents typos: `InstrumentKind.HTTP` vs `"htpp"` string error

### 4. Encapsulation of Internal APIs

`nativeHooks` is an implementation detail:
- Only bun-otel TypeScript bridges need it (HTTP, fetch, SQL handlers)
- Exposes low-level notification mechanisms
- Requires understanding of header caching, configuration properties
- Not intended for direct user consumption
- Could change implementation without affecting public API

By excluding from public types:
- Users don't see confusing internal APIs in autocomplete
- Freedom to refactor internal bridge architecture
- Clear public/private boundary

## Options Considered

### Option 1: All Types in bun-types (Single Location)
**Rejected**: Would expose internal APIs to all users, creating confusion and stability constraints.

### Option 2: All Types in bun-otel (SDK Only)
**Rejected**: Forces dependency on bun-otel even for custom implementations, prevents bespoke solutions.

### Option 3: Duplicate Types in Both Packages
**Rejected**: Maintenance burden, risk of drift between definitions, confusing source of truth.

### Option 4: Use Numeric Enums in Public API
**Rejected**: Less ergonomic, requires imports, less self-documenting than string literals.

### Option 5: Use String Literals in Internal API
**Rejected**: Loses type safety, no compile-time validation of Zig enum mapping, error-prone.

## Consequences

### Benefits

1. **Clear Separation**: Public API (ergonomic) vs internal API (type-safe)
2. **Zero Dependencies**: Users can write instrumentations without installing bun-otel
3. **Bespoke Implementations**: Advanced users can build custom telemetry solutions
4. **Encapsulation**: Internal APIs hidden from public surface
5. **Type Safety**: Internal code gets compile-time enum validation
6. **Stability**: Public API uses stable string literals

### Tradeoffs

1. **Two Sources of Truth**: Must keep string literals in sync with enum values
   - *Mitigation*: Helper function validates mapping, tests verify consistency
2. **Module Augmentation**: bun-otel extends Bun namespace via `declare module "bun"`
   - *Mitigation*: Standard TypeScript pattern, well-documented
3. **Documentation Split**: Users must know where to find types
   - *Mitigation*: Clear guidelines in specs, ADRs document rationale

### Implementation Notes

**String to Enum Mapping** (bun-otel/types.ts):
```typescript
export function getInstrumentKindValue(type: string): InstrumentKind {
  const map: Record<string, InstrumentKind> = {
    "custom": InstrumentKind.Custom,
    "http": InstrumentKind.HTTP,
    "fetch": InstrumentKind.Fetch,
    "sql": InstrumentKind.SQL,
    "redis": InstrumentKind.Redis,
    "s3": InstrumentKind.S3,
  };
  const value = map[type];
  if (value === undefined) {
    throw new Error(`Unknown instrument type: ${type}`);
  }
  return value;
}
```

**Module Augmentation** (bun-otel/types.ts):
```typescript
declare module "bun" {
  namespace Bun {
    namespace telemetry {
      namespace nativeHooks {
        function isEnabledFor(kind: InstrumentKind): boolean;
        function notifyStart(kind: InstrumentKind, id: number, attributes: any): void;
        // ... other internal functions
      }
    }
  }
}
```

## References

- ADR-001: Telemetry API Design Decisions
- ADR-002: Hook Lifecycle and Attribute Design
- `packages/bun-types/telemetry.d.ts` - Public API definitions
- `packages/bun-otel/types.ts` - Internal API definitions (not exported)
- `specs/001-opentelemetry-support/contracts/bun-telemetry-api.md` - Public API contract
- `specs/001-opentelemetry-support/contracts/native-hooks-api.md` - Internal bridge API
