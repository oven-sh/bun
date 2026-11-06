interface NewRelicForTheSmoke {
  getTraceMetadata(): { traceId?: string; spanId?: string };
  startBackgroundTransaction<T>(name: string, work: () => Promise<T>): Promise<T>;
  getTransaction(): { end(): void };
}
