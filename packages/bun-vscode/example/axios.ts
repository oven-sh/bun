import axios from 'axios';

const res = await axios.get('http://127.0.0.1:8080/status/500').catch(e => {
    throw e;
});

console.log(res.statusText);