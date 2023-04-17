<script>
    let counter = 0;
</script>
<style>
    button {
        background: green;
        color:#FFF;
    }
</style>

I'm counting ... {counter}
<button on:click={() => {counter++}}>Count up</button>