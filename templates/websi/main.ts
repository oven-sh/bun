import { Server } from 'websi';
import { GET } from 'websi/route';
import * as Response from 'websi/response';

const routes = [
  GET('/', () => Response.OK('Hello, Websi!'))
]

const server = Server(routes);
export default server;
