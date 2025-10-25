import { Context } from "@opentelemetry/api";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";
import { AsyncLocalStorage } from "async_hooks";

export type BunInstrumentationConfig = InstrumentationConfig & {
  /**
   * Shared AsyncLocalStorage instance for context propagation.
   * Provided by BunSDK to enable trace context sharing between instrumentations.
   * @internal
   */
  contextStorage?: AsyncLocalStorage<Context>;
};

export class BunAbstractInstrumentation<T extends BunInstrumentationConfig> implements Instrumentation<T> {
  // Abstract base class for Bun instrumentations
}
