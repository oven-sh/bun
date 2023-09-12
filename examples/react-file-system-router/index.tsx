// A simple way to connect FileSystemRouter to Bun#serve
// run with `bun run index.tsx`

import { renderToReadableStream } from "react-dom/server";
import { FileSystemRouter } from "bun";
import {Logo} from './components/logo'


export default {
  port: 3000,
  async fetch(request: Request) {
    const router = new FileSystemRouter({
      dir: process.cwd() + "/pages",
      style: "nextjs",
    });

    const route = router.match(request);
    if(route?.filePath){
      const { default: Root } = await import(route.filePath);
      return new Response(await renderToReadableStream(<Wrapper><Root {...route.params} /></Wrapper>));
  } else {
      return  new Response( 'File not found', { status: 404 } )
  }
  },
};

const Wrapper = ({children, title}:{children:React.ReactNode})=>(
  <html>
    <head>
      <meta charSet="utf-8"/>
    </head>
    <body style={{textAlign:'center'}}>
      <Logo />
      {children}
    </body>
  </html>
)