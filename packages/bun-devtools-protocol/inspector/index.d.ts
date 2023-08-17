import type { JSC, V8 } from "..";

export type AnyRequest = JSC.Request | V8.Request;
export type AnyRequestMap = JSC.RequestMap | V8.RequestMap;
export type AnyResponse = JSC.Response | V8.Response;
export type AnyResponseMap = JSC.ResponseMap | V8.ResponseMap;
export type AnyEvent = JSC.Event | V8.Event;
export type AnyEventMap = JSC.EventMap | V8.EventMap;

/**
 * A client that can send and receive messages to/from a debugger.
 */
export abstract class Inspector<
  RequestMap extends AnyRequestMap = JSC.RequestMap,
  ResponseMap extends AnyResponseMap = JSC.ResponseMap,
  EventMap extends AnyEventMap = JSC.EventMap,
> {
  constructor(listener?: InspectorListener<EventMap>);
  /**
   * Sends a request to the debugger.
   */
  send<M extends keyof RequestMap & keyof ResponseMap>(method: M, params?: RequestMap[M]): Promise<ResponseMap[M]>;
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
  close(): void;
}

export type InspectorListener<EventMap extends AnyEventMap = JSC.EventMap> = {
  /**
   * Defines a handler when a debugger event is received.
   */
  [M in keyof EventMap]?: (event: EventMap[M]) => void;
} & {
  /**
   * Defines a handler when the debugger is connected or reconnected.
   */
  ["Inspector.connected"]?: () => void;
  /**
   * Defines a handler when the debugger is disconnected.
   * @param error the error that caused the disconnect, if any
   * @returns `true` if the inspector should reconnect, `false` otherwise
   */
  ["Inspector.disconnected"]?: (error?: Error) => void;
};
