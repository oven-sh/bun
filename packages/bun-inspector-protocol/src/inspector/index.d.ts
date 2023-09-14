import type { EventEmitter } from "node:events";
import type { JSC } from "../protocol";

export type InspectorEventMap = {
  [E in keyof JSC.EventMap]: [JSC.EventMap[E]];
} & {
  "Inspector.connecting": [string];
  "Inspector.connected": [];
  "Inspector.disconnected": [Error | undefined];
  "Inspector.error": [Error];
  "Inspector.pendingRequest": [JSC.Request];
  "Inspector.request": [JSC.Request];
  "Inspector.response": [JSC.Response];
  "Inspector.event": [JSC.Event];
};

/**
 * A client that can send and receive messages to/from a debugger.
 */
export interface Inspector extends EventEmitter<InspectorEventMap> {
  /**
   * Starts the inspector.
   */
  start(...args: unknown[]): Promise<boolean>;
  /**
   * Sends a request to the debugger.
   */
  send<M extends keyof JSC.RequestMap & keyof JSC.ResponseMap>(
    method: M,
    params?: JSC.RequestMap[M],
  ): Promise<JSC.ResponseMap[M]>;
  /**
   * If the inspector is closed.
   */
  get closed(): boolean;
  /**
   * Closes the inspector.
   */
  close(...args: unknown[]): void;
}
