import { useSyncExternalStore, type SetStateAction } from "react";

const UNINITIALIZED = {} as never;

export interface Store<T> {
  read(): T;
  write(value: SetStateAction<T>): void;
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

    write(next) {
      const current = this.read();
      const resolved = next instanceof Function ? next(current) : next;
      if (Object.is(current, resolved)) return;
      value = resolved;
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
