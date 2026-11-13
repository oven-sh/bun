export interface Options {
  port: number;
  host?: string;
}

export function listen(options: Options) {
  return options.port;
}
