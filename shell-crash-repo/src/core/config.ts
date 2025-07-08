import { Config } from '../types';

export class ConfigManager {
  private config: Config;
  
  constructor() {
    this.config = {
      apiKey: '',
      baseUrl: 'https://api.example.com',
      timeout: 5000
    };
  }
  
  get(): Config {
    return this.config;
  }
  
  set(key: keyof Config, value: any): void {
    this.config[key] = value;
  }
}