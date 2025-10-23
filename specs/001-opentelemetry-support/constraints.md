# Implementation Constraints: OpenTelemetry Support for Bun

**Feature Branch**: `001-opentelemetry-support`
**Created**: 2025-10-23
**Status**: Draft

This document contains implementation-level constraints and technical requirements that inform how the OpenTelemetry support feature should be built. These constraints are separate from the functional requirements in spec.md but are important for ensuring the implementation meets performance, safety, and architectural goals.

## Performance Constraints

### Zero-Cost Abstraction When Disabled

- **CON-001**: `enabled()` check MUST be inlined and compile to single boolean check
- **CON-002**: Instrumentation blocks in the hot-path MUST be the shortest canonical representation of the necessary functionality
- **CON-003**: `notifyOperation*` functions MUST be inline functions (zero call overhead)
- **CON-004**: AttributeMap operations MUST NOT allocate when telemetry disabled

**Rationale**: These constraints ensure SC-004 (<0.1% overhead when disabled) is achievable through compiler optimizations rather than runtime checks.

### Minimal Allocation Strategy

- **CON-005**: All memory allocations in telemetry native hooks MUST be annotated with `// TODO OTEL_MALLOC - REVIEW` unless explicitly justified with human-reviewed `// OTEL_MALLOC - <reason>` comments
- **CON-006**: TelemetryContext returned by `enabled()` MUST NOT require cleanup (no deinit)
- **CON-007**: AttributeMap created by `createAttributeMap()` MUST be stack-allocated and not require cleanup
- **CON-008**: AttributeMap passed to `notifyOperation*` methods MUST remain valid for the duration of the call only (no ownership transfer)

**Rationale**: Minimizing allocations and managing memory predictably ensures low overhead (SC-003) and prevents memory leaks or fragmentation under high load.

### Synchronous Operation Requirements

- **CON-009**: Header injection MUST support synchronous response from TypeScript (no async allowed at this layer)

**Rationale**: Async operations in the hot path would add significant latency and complexity. Synchronous operations keep the request processing pipeline predictable.

## Memory Management Constraints

### Operation Identity Management

- **CON-010**: Operation IDs (OpId/u64) MUST be monotonic and never reused within process lifetime

**Rationale**: Monotonic IDs prevent confusion when correlating async operations and ensure proper parent-child span relationships without requiring complex ID recycling logic.

## Error Handling Constraints

### Configuration and Initialization

- **CON-011**: `init()` and `attach()` MUST raise global error on invalid configuration
- **CON-012**: `enabled()` MUST return null if initialization failed (never throws)

**Rationale**: Fail-fast at startup ensures configuration errors are caught early, but runtime checks must be safe to prevent crashing production applications.

### Runtime Error Handling

- **CON-013**: `notifyOperation*` functions MUST silently fail on OOM (no errors to caller)

**Rationale**: Telemetry failures should never impact application behavior. Silent failure with potential data loss is preferable to application crashes.

## Thread Safety Constraints

- **CON-014**: All telemetry operations MUST be thread-safe:
  - `enabled()` uses atomic read
  - `generateId()` uses atomic increment
  - `notifyOperation*` functions have safe concurrent access
  - AttributeKeys singleton is immutable after initialization

**Rationale**: Bun supports worker threads and concurrent operations. Thread safety prevents data races and ensures correct operation in multi-threaded environments.

## ShadowRealm Support Constraints

### Realm Isolation

- **CON-015**: TelemetryContext MUST support independent JavaScript realm contexts (including shadowRealms)
- **CON-016**: Instrumentation MAY run in a different realm than the execution context

**Rationale**: ShadowRealms are a JavaScript feature for isolated execution contexts. Supporting them ensures telemetry works in complex application architectures.

### Data Transfer Between Realms

- **CON-017**: AttributeMap MUST store primitive JSValues (strings, numbers) which CAN be passed between realm contexts within the same VM
- **CON-018**: AttributeMap MUST NOT store object JSValues that cannot cross realm boundaries

**Rationale**: Objects cannot be safely shared between realms. Restricting to primitives ensures data can flow between realms without serialization overhead.

## GlobalObject Binding Constraints

### Realm Binding Rules

- **CON-019**: The first call to `Bun.telemetry.attach()` MUST capture the caller's GlobalObject context for all subsequent telemetry operations
- **CON-020**: All telemetry operations (AttributeMap allocations, callback invocations, context management) MUST use the captured GlobalObject from the initial `attach()` call
- **CON-021**: Subsequent `attach()` calls from a DIFFERENT GlobalObject in the same VM MUST throw an error: "Telemetry already bound to a different realm"
- **CON-022**: Subsequent `attach()` calls from the SAME GlobalObject MUST succeed and register the additional instrument
- **CON-023**: When telemetry is disabled via configuration OR when all instruments are removed (last `detach()` call), the GlobalObject binding MUST be reset, allowing a new `attach()` from a different realm to succeed

**Rationale**: These constraints prevent complex bugs from mixing realm contexts while allowing legitimate multi-instrumentation scenarios. The binding reset on full detach enables testing and reconfiguration scenarios.

## Package Architecture Constraints

### Instrumentation Code Location

- **CON-024**: TypeScript instrumentation code for OpenTelemetry integration MUST be located in user-loadable packages (e.g., `packages/bun-otel`), NOT in internal runtime modules (e.g., `src/js/internal/`)
- **CON-025**: Internal runtime modules (e.g., `src/js/node/_http_server.ts`) MUST call native `Bun.telemetry` hooks directly without requiring intermediate TypeScript bridge modules
- **CON-026**: Instrumentation packages MUST only load when explicitly imported by user code to ensure zero startup cost for applications not using telemetry

**Rationale**: This ensures CON-001 and CON-002 are achievable. Internal modules load on every startup (when their API is used), adding parsing and memory overhead even when telemetry is disabled. User-loadable packages only load when explicitly imported, ensuring true zero cost for non-telemetry applications.

### TypeScript to Native Integration

- **CON-027**: Instrumentation packages MAY import OpenTelemetry npm packages (e.g., `@opentelemetry/api`, `@opentelemetry/semantic-conventions`) to access official constants and types
- **CON-028**: Internal runtime modules MUST NOT import npm packages, preventing duplication of constants and ensuring they remain lightweight

**Rationale**: Instrumentation packages need access to official OpenTelemetry constants and utilities to ensure spec compliance. Internal modules cannot import npm packages without bloating the runtime.

### Code Sharing Between HTTP Implementations

- **CON-029**: A single instrumentation class (e.g., `BunHttpInstrumentation`) SHOULD handle both native `Bun.serve()` and Node.js `http.createServer()` telemetry hooks to maximize code reuse
- **CON-030**: The instrumentation receives operation callbacks from the native layer with sufficient context (request/response objects) to extract all required semantic convention attributes for both HTTP server implementations

**Rationale**: Sharing code reduces maintenance burden and ensures consistent behavior across HTTP implementations while keeping the instrumentation package size manageable.

## Implementation Notes

These constraints are derived from:

1. Performance goals (SC-003, SC-004)
2. Architectural decisions about native Zig integration
3. JavaScript engine features (ShadowRealms, GlobalObject contexts)
4. Memory safety and reliability requirements

Implementation teams should reference these constraints when:

- Designing the native Zig telemetry APIs
- Implementing TypeScript instrumentation bridges
- Reviewing code for memory safety
- Debugging performance issues
- Testing multi-realm scenarios
