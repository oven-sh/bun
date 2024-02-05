import {createClient} from 'edgedb';
const client = createClient();
const result = await client.querySingle(`select uuid_generate_v1mc();`);
console.log(result);