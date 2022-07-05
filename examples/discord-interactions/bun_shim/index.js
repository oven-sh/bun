import { Creator } from 'slash-create';
import { FetchRequestHandler } from './rest.js';
export { default as BunServer } from './server.js';

export class BunSlashCreator extends Creator {
  constructor(...args) {
    super(...args);
    this.requestHandler = new FetchRequestHandler(this);
  }
}