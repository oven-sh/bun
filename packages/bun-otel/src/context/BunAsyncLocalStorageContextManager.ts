import { Context, ROOT_CONTEXT } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Custom OpenTelemetry context manager that uses a shared AsyncLocalStorage instance.
 *
 * This allows Bun's native telemetry hooks to share async context with OpenTelemetry
 * instrumentations. When Bun's Zig code calls storage.enterWith({ requestId }), it updates
 * the same storage that OpenTelemetry's context.active() reads from.
 *
 * Why this is needed:
 * - OTel's default AsyncLocalStorageContextManager creates its OWN AsyncLocalStorage
 * - Bun.telemetry receives a DIFFERENT AsyncLocalStorage from user code
 * - These two instances don't share data, breaking trace propagation
 * - This custom manager bridges them by accepting an external storage instance
 *
 * @example
 * ```typescript
 * const sharedStorage = new AsyncLocalStorage();
 * const contextManager = new BunAsyncLocalStorageContextManager(sharedStorage);
 *
 * // Both OTel and Bun use the same storage:
 * context.setGlobalContextManager(contextManager);
 * Bun.telemetry.configure({ _contextStorage: sharedStorage });
 * ```
 */
export class BunAsyncLocalStorageContextManager extends AsyncHooksContextManager {
  private _asyncLocalStorage: AsyncLocalStorage<Context>;

  /**
   * @param asyncLocalStorage - Shared AsyncLocalStorage instance used by Bun.telemetry
   */
  constructor(asyncLocalStorage: AsyncLocalStorage<Context> = new AsyncLocalStorage()) {
    super();
    this._asyncLocalStorage = asyncLocalStorage;
  }

  active(): Context {
    const store = this._asyncLocalStorage.getStore();
    // Validate that the store is actually a Context object, not a plain object from Zig
    // Zig may call enterWith({ requestId }) before JS sets up the proper Context
    if (!store || typeof store.getValue !== "function") {
      return ROOT_CONTEXT;
    }
    return store;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const cb = thisArg == null ? fn : fn.bind(thisArg);
    return this._asyncLocalStorage.run(context, cb as never, ...args);
  }

  enable(): this {
    return this;
  }

  disable(): this {
    this._asyncLocalStorage.disable();
    return this;
  }

  enterWith(context: Context): this {
    this._asyncLocalStorage.enterWith(context);
    return this;
  }
}
