declare module "sql.js" {
  interface Statement {
    run(values: (string | number)[]): void;
    free(): void;
  }
  interface Database {
    run(sql: string): void;
    prepare(sql: string): Statement;
    exec(sql: string): { columns: string[]; values: unknown[][] }[];
    close(): void;
  }
  export default function initSqlJs(): Promise<{ Database: new () => Database }>;
}
