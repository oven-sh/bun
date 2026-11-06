<script lang="ts">
  let { data } = $props();
</script>
<p>{data.now}</p>
{#await data.later}<p>waiting</p>{:then word}<p>{word}</p>{/await}
