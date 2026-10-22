export interface LazyQuery<T> extends Promise<T> {
  readonly text: string;
}
export function query<T>(text: string, result: T): LazyQuery<T>;
