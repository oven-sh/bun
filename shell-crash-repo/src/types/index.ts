export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Config {
  apiKey: string;
  baseUrl: string;
  timeout: number;
}