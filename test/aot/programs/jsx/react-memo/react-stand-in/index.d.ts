export function render<P, R>(component: (props: P) => R, props: P): R;
export function breakContract(value: unknown): void;
export function keepContract(): void;
export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
export function useCallback<T extends Function>(callback: T, deps: readonly unknown[]): T;
export function useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void];
export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void];
export function useRef<T>(initial: T): { current: T };
// As in @types/react: declared callable, although `createContext` returns a plain object that is never called.
export interface Context<T> { (props: { value: T }): unknown; Provider: unknown; Consumer: unknown; }
export function createContext<T>(value: T): Context<T>;
export function useContext<T>(context: Context<T>): T;
