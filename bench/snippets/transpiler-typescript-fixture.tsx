// Input for transpiler-typescript.mjs. It is parsed, never run.
// It packs the TypeScript-only syntax that a .tsx file mixes into JSX: type
// arguments on elements and calls, casts, non-null assertions, generic arrow
// functions, and comments between the attributes of an opening tag.
import type { ComponentProps, ReactNode, Ref } from "react";
import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from "react";

export enum Density {
  Compact = "compact",
  Regular = "regular",
  Loose = "loose",
}

declare const enum Flags {
  None = 0,
  Selected = 1 << 0,
  Disabled = 1 << 1,
}

type Id = string & { readonly __brand: unique symbol };
type Key<T> = Extract<keyof T, string>;
type Sorter<T> = { [K in Key<T>]?: (a: T[K], b: T[K]) => number };
type Cell<T, K extends Key<T> = Key<T>> = K extends unknown ? { key: K; value: T[K]; label: `col-${K}` } : never;
type Unwrap<T> = T extends Promise<infer U> ? Unwrap<U> : T extends readonly (infer E)[] ? E : T;
type Handler<E extends keyof HTMLElementEventMap = "click"> = (
  this: HTMLElement,
  event: HTMLElementEventMap[E],
) => void;

export interface Row {
  id: Id;
  name: string;
  tags?: readonly string[];
  owner: { login: string; avatar?: URL } | null;
  updated: Date;
  [extra: `data-${string}`]: string | undefined;
}

export interface Column<T, K extends Key<T> = Key<T>> {
  key: K;
  title: ReactNode;
  width?: number | `${number}%`;
  render?(value: T[K], row: T, index: number): ReactNode;
  compare?: Sorter<T>[K];
}

interface TableProps<T extends { id: Id }> extends Omit<ComponentProps<"table">, "children" | "onSelect"> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  density?: Density;
  selected?: ReadonlySet<Id>;
  onSelect?: Dispatch<SetStateAction<ReadonlySet<Id>>>;
  empty?: ReactNode;
  tableRef?: Ref<HTMLTableElement>;
}

abstract class Store<T extends { id: Id }> {
  protected readonly items = new Map<Id, T>();
  private static count: number = 0;
  declare readonly kind: string;
  constructor(
    public readonly name: string,
    protected flags: Flags = Flags.None,
  ) {
    Store.count++;
  }
  abstract load(signal?: AbortSignal): Promise<readonly T[]>;
  get(id: Id): T | undefined;
  get(id: Id, fallback: T): T;
  get(id: Id, fallback?: T): T | undefined {
    return this.items.get(id) ?? fallback;
  }
  has(id: Id): this is Store<T> & { last: T } {
    return this.items.has(id);
  }
}

class RowStore extends Store<Row> implements Iterable<Row> {
  override async load(signal?: AbortSignal): Promise<readonly Row[]> {
    const response = await fetch("/rows", { signal });
    const rows = (await response.json()) as Row[];
    for (const row of rows) this.items.set(row.id, row satisfies Row);
    return rows;
  }
  *[Symbol.iterator](): Iterator<Row> {
    yield* this.items.values();
  }
}

const identity = <T,>(value: T): T => value;
const pick = <T, const K extends readonly Key<T>[]>(row: T, ...keys: K): Pick<T, K[number]> =>
  Object.fromEntries(keys.map(key => [key, row[key]])) as Pick<T, K[number]>;

function cells<T extends object>(row: T, columns: readonly Column<T>[]): Cell<T>[] {
  return columns.map(column => ({ key: column.key, value: row[column.key], label: `col-${column.key}` }) as Cell<T>);
}

function assertRow(value: unknown): asserts value is Row {
  if (typeof value !== "object" || value === null || !("id" in value)) throw new TypeError("not a row");
}

export function Table<T extends { id: Id }>({
  rows,
  columns,
  density = Density.Regular,
  selected,
  onSelect,
  empty,
  tableRef,
  ...rest
}: TableProps<T>): ReactNode {
  const [sortKey, setSortKey] = useState<Key<T> | undefined>(undefined);
  const [descending, setDescending] = useState<boolean>(false);

  const sorted = useMemo<readonly T[]>(() => {
    if (sortKey === undefined) return rows;
    const column = columns.find(c => c.key === sortKey)!;
    const compare = (column.compare ?? ((a: unknown, b: unknown) => String(a).localeCompare(String(b)))) as (
      a: T[Key<T>],
      b: T[Key<T>],
    ) => number;
    const copy = [...rows].sort((a, b) => compare(a[sortKey], b[sortKey]));
    return descending ? copy.reverse() : copy;
  }, [rows, columns, sortKey, descending]);

  const toggle = useCallback(
    (id: Id): void => {
      onSelect?.(previous => {
        const next = new Set<Id>(previous);
        next.has(id) ? next.delete(id) : next.add(id);
        return next as ReadonlySet<Id>;
      });
    },
    [onSelect],
  );

  if (sorted.length === 0) {
    return (
      <p
        // shown when the filter removes every row
        className="table-empty"
        /* keep the live region polite */ aria-live="polite"
      >
        {empty ?? "No rows"}
      </p>
    );
  }

  return (
    <table
      {...rest}
      ref={tableRef}
      // density drives the row height
      data-density={density}
      className={["table", rest.className].filter(Boolean).join(" ")}
    >
      <thead>
        <tr>
          {columns.map(column => (
            <th
              key={column.key}
              /* width is optional */
              style={{ width: column.width }}
              // a second click flips the direction
              onClick={() => {
                setDescending(column.key === sortKey ? !descending : false);
                setSortKey(column.key);
              }}
              aria-sort={column.key !== sortKey ? "none" : descending ? "descending" : "ascending"}
            >
              {column.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, index) => (
          <tr
            key={row.id}
            // selection is owned by the caller
            aria-selected={selected?.has(row.id) ?? false}
            onClick={() => toggle(row.id)}
          >
            {cells<T>(row as T & object, columns).map(cell => (
              <td key={cell.key} /* one cell per column */ data-label={cell.label}>
                {columns.find(c => c.key === cell.key)!.render?.(cell.value, row, index) ??
                  String(identity<unknown>(cell.value))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RowTable(props: Omit<TableProps<Row>, "columns">): ReactNode {
  const columns = useMemo(
    () =>
      [
        { key: "name", title: "Name", width: "40%" },
        { key: "owner", title: "Owner", render: owner => (owner as Row["owner"])?.login ?? <em>nobody</em> },
        {
          key: "updated",
          title: <abbr title="last update">Updated</abbr>,
          render: value => (value as Date).toISOString(),
        },
      ] as const satisfies readonly Column<Row>[],
    [],
  );
  return (
    <Table<Row>
      {...props}
      // the generic argument pins the row type
      columns={columns}
      density={props.density ?? Density.Compact}
    />
  );
}

export type { Cell, Handler, Sorter, Unwrap };
export { assertRow, pick, RowStore };
