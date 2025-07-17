import type { ExtensionContext } from "vscode";

export const GLOBAL_STATE_VERSION = 1;

export type GlobalStateTypes = {
  BUN_INSPECT_CONNECT_TO:
    | {
        type: "tcp";
        port: number;
      }
    | {
        type: "unix";
        url: string;
      };

  DIAGNOSTICS_BUN_INSPECT: string;
};

export async function clearGlobalState(gs: ExtensionContext["globalState"]) {
  const tgs = typedGlobalState(gs);

  await Promise.all(tgs.keys().map(key => tgs.update(key, undefined as never)));
}

export function typedGlobalState(state: ExtensionContext["globalState"]) {
  return state as {
    get<K extends keyof GlobalStateTypes>(key: K): GlobalStateTypes[K] | undefined;

    keys(): readonly (keyof GlobalStateTypes)[];

    update<K extends keyof GlobalStateTypes>(key: K, value: GlobalStateTypes[K]): Thenable<void>;

    /**
     * Set the keys whose values should be synchronized across devices when synchronizing user-data
     * like configuration, extensions, and mementos.
     *
     * Note that this function defines the whole set of keys whose values are synchronized:
     *  - calling it with an empty array stops synchronization for this memento
     *  - calling it with a non-empty array replaces all keys whose values are synchronized
     *
     * For any given set of keys this function needs to be called only once but there is no harm in
     * repeatedly calling it.
     *
     * @param keys The set of keys whose values are synced.
     */
    setKeysForSync(keys: readonly (keyof GlobalStateTypes)[]): void;
  };
}

export function createGlobalStateGenerationFn<T extends keyof GlobalStateTypes>(
  key: T,
  resolve: () => Promise<GlobalStateTypes[T]>,
) {
  return async (gs: ExtensionContext["globalState"]) => {
    const value = (gs as TypedGlobalState).get(key);
    if (value) return value;

    const next = await resolve();
    await (gs as TypedGlobalState).update(key, next);

    return next;
  };
}

export type TypedGlobalState = ReturnType<typeof typedGlobalState>;
