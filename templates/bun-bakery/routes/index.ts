import {Context} from "@kapsonfire/bun-bakery"

export async function GET(ctx: Context) {
    ctx.sendHTML('<img src="/assets/bunbakery.png"><h1>Hello World!</h1>');
}