import type { JSC } from "..";

/**
 * A client that can send and receive messages to/from a debugger.
 */
export abstract class Inspector {
  constructor(listener?: InspectorListener);
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
   * Accepts a message from the debugger.
   * @param message the unparsed message from the debugger
   */
  accept(message: string): void;
  /**
   * If the inspector is closed.
   */
  get closed(): boolean;
  /**
   * Closes the inspector.
   */
  close(...args: unknown[]): void;
}

export type InspectorListener = {
  /**
   * Defines a handler when a debugger event is received.
   */
  [M in keyof JSC.EventMap]?: (event: JSC.EventMap[M]) => void;
} & {
  /**
   * Defines a handler when the debugger is connected or reconnected.
   */
  ["Inspector.connected"]?: () => void;
  /**
   * Defines a handler when the debugger is disconnected.
   * @param error the error that caused the disconnect, if any
   */
  ["Inspector.disconnected"]?: (error?: Error) => void;
};
