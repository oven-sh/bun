export class Context {
  private data: Map<string, any>;
  
  constructor() {
    this.data = new Map();
  }
  
  set(key: string, value: any): void {
    this.data.set(key, value);
  }
  
  get<T>(key: string): T | undefined {
    return this.data.get(key);
  }
}