import { useSyncExternalStore } from "react";

const UNINITIALIZED = {} as never;

export interface Store<T> {
  read(): T;
  write(value: T): void;
  subscribe(callback: () => void): () => boolean;
}

function notify(set: Set<() => void>) {
  for (const callback of set) callback();
}

export function store<T>(init: T = UNINITIALIZED): Store<T> {
  let value = init;
  const subscribers = new Set<() => void>();

  return {
    read() {
      if (value === UNINITIALIZED) {
        throw new Error("State not initialized");
      }

      return value;
    },

    write(next: T) {
      value = next;
      notify(subscribers);
    },

    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.read, store.read);
}
