<script lang="ts">
  let { data, form } = $props();
</script>
<form method="POST"><input name="word" /><button>remember</button></form>
<p>remembered {data.remembered}; the action said {JSON.stringify(form)}</p>
