import { ExtensionContext } from "vscode";

export type GlobalStateTypes = {
  BUN_INSPECT_NOTIFY:
    | {
        type: "tcp";
        port: number;
      }
    | {
        type: "unix";
        url: string;
      };
};

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

export type TypedGlobalState = ReturnType<typeof typedGlobalState>;
