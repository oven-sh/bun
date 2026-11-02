export interface Plain {
  method: string;
  url: string;
  headers: object;
}
export declare class Wrapped {
  constructor(request: Plain);
  method: string;
  url: string;
  streaming: boolean;
  get original(): Plain;
}
