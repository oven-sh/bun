import {Context} from "@kapsonfire/bun-bakery"

export async function GET(ctx: Context) {
    ctx.sendResponse(new Response('<img src="/assets/bunbakery.png"><h1>Hello World!</h1>', {
        headers: {
            'content-type': 'text/html'
        }
    }));
}